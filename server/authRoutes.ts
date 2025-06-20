import type { Express, Request, Response } from "express";
import passport from './auth';
import bcrypt from 'bcryptjs';
import { storage } from './db';
import { insertUserSchema } from '@shared/schema';
import { ZodError } from 'zod';
import { TwitterOAuth2 } from './twitterOAuth';
import { setupTwitterAuthFallback } from './twitterAuthFallback';
import { setupSimpleTwitterAuth } from './twitterOAuthSimple';

// In-memory storage for OAuth states
const oauthStates = new Map<string, { returnTo: string; timestamp: number }>();

export function registerAuthRoutes(app: Express) {
  console.log('Registering auth routes...');
  
  // Set up all Twitter OAuth strategies
  setupTwitterAuthFallback();
  setupSimpleTwitterAuth(app);
  
  // Local registration endpoint
  app.post('/auth/register', async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;
      
      // Validate input
      if (!username || !email || !password) {
        return res.status(400).json({ message: 'Username, email, and password are required' });
      }

      // Check if user already exists (case-insensitive)
      const existingUser = await storage.getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }

      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(400).json({ message: 'Username is already taken' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user (store email in lowercase)
      const newUser = await storage.createUser({
        username,
        email: email.toLowerCase(),
        password: hashedPassword,
        provider: 'local',
        providerId: null,
        displayName: username,
        avatar: null
      });

      // Log in the user
      req.login(newUser, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Registration successful but login failed' });
        }
        res.status(201).json({ 
          message: 'Registration successful', 
          user: {
            id: newUser.id,
            username: newUser.username,
            email: newUser.email,
            displayName: newUser.displayName,
            avatar: newUser.avatar
          }
        });
      });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Local login endpoint
  app.post('/auth/login', (req: Request, res: Response, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: 'Authentication error' });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || 'Invalid credentials' });
      }
      
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: 'Login failed' });
        }
        res.json({ 
          message: 'Login successful', 
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            avatar: user.avatar
          }
        });
      });
    })(req, res, next);
  });

  // Google OAuth routes
  console.log('Registering Google OAuth routes...');
  app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account' // Force account selection screen
  }));

  app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/?error=google_auth_failed' }),
    (req: Request, res: Response) => {
      console.log('Google OAuth successful - user logged in');
      res.redirect('/');
    }
  );

  // Facebook OAuth routes
  app.get('/auth/facebook',
    passport.authenticate('facebook', { scope: ['email'] })
  );

  app.get('/auth/facebook/callback',
    passport.authenticate('facebook', { failureRedirect: '/login?error=facebook_auth_failed' }),
    (req: Request, res: Response) => {
      res.redirect('/?auth_success=true');
    }
  );

  // Twitter OAuth routes
  app.get('/auth/twitter', (req: Request, res: Response) => {
    console.log('Twitter OAuth route accessed');
    console.log('Environment check:', {
      hasTwitterKey: !!process.env.TWITTER_CONSUMER_KEY,
      hasTwitterSecret: !!process.env.TWITTER_CONSUMER_SECRET,
      replitDomains: process.env.REPLIT_DOMAINS,
      nodeEnv: process.env.NODE_ENV
    });
    
    try {
      // Use production URL for Twitter OAuth callback
      const baseURL = process.env.NODE_ENV === 'production' 
        ? 'https://globaltradingtycoon.app'
        : process.env.REPLIT_DOMAINS 
          ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` 
          : 'http://localhost:5000';
      
      console.log('Using base URL for Twitter OAuth:', baseURL);
      
      if (!process.env.TWITTER_CONSUMER_KEY || !process.env.TWITTER_CONSUMER_SECRET) {
        console.error('Twitter OAuth credentials missing');
        return res.redirect('/?error=twitter_config_missing');
      }
      
      const twitterOAuth = new TwitterOAuth2(
        process.env.TWITTER_CONSUMER_KEY,
        process.env.TWITTER_CONSUMER_SECRET,
        `${baseURL}/auth/twitter/callback`
      );

      const { url, codeVerifier, state } = twitterOAuth.generateAuthUrl();
      
      // Store code verifier and state in session
      (req.session as any).twitterCodeVerifier = codeVerifier;
      (req.session as any).twitterState = state;
      
      console.log('Generated Twitter OAuth URL:', url);
      console.log('Stored session data:', {
        hasCodeVerifier: !!codeVerifier,
        hasState: !!state
      });
      
      res.redirect(url);
    } catch (error) {
      console.error('Twitter OAuth initiation error:', error);
      console.error('Error stack:', (error as Error).stack);
      res.redirect('/?error=twitter_init_failed');
    }
  });

  app.get('/auth/twitter/callback', async (req: Request, res: Response) => {
    console.log('Twitter OAuth callback received');
    console.log('Callback query parameters:', req.query);
    console.log('Session data:', {
      hasCodeVerifier: !!(req.session as any).twitterCodeVerifier,
      hasState: !!(req.session as any).twitterState
    });
    
    try {
      const { code, state, error, error_description } = req.query;
      
      if (error) {
        console.error('Twitter OAuth error:', error);
        console.error('Error description:', error_description);
        return res.redirect(`/?error=twitter_auth_failed&details=${encodeURIComponent(error as string)}`);
      }

      if (!code || !state) {
        console.error('Missing code or state parameter', { hasCode: !!code, hasState: !!state });
        return res.redirect('/?error=twitter_missing_params');
      }

      // Verify state parameter
      const sessionState = (req.session as any).twitterState;
      if (state !== sessionState) {
        console.error('State parameter mismatch', { 
          received: state, 
          expected: sessionState 
        });
        return res.redirect('/?error=twitter_state_mismatch');
      }

      // Use production URL for Twitter OAuth callback
      const baseURL = process.env.NODE_ENV === 'production' 
        ? 'https://globaltradingtycoon.app'
        : process.env.REPLIT_DOMAINS 
          ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` 
          : 'http://localhost:5000';
      
      const twitterOAuth = new TwitterOAuth2(
        process.env.TWITTER_CONSUMER_KEY!,
        process.env.TWITTER_CONSUMER_SECRET!,
        `${baseURL}/auth/twitter/callback`
      );

      // Exchange code for access token
      const tokenData = await twitterOAuth.exchangeCodeForToken(
        code as string, 
        (req.session as any).twitterCodeVerifier
      );

      // Get user information
      const userData = await twitterOAuth.getUserInfo(tokenData.access_token);
      const twitterUser = userData.data;

      console.log('Twitter user data:', twitterUser);

      // Check if user exists with this Twitter ID
      let user = await storage.getUserByProvider('twitter', twitterUser.id);
      
      if (!user) {
        // Create new user
        const newUserData = {
          username: twitterUser.username || `twitter_${twitterUser.id}`,
          email: null,
          password: null,
          provider: 'twitter',
          providerId: twitterUser.id,
          displayName: twitterUser.name || twitterUser.username,
          avatar: twitterUser.profile_image_url || null
        };
        
        user = await storage.createUser(newUserData);
        console.log('New Twitter user created:', user.id);
      } else {
        console.log('Existing Twitter user found:', user.id);
      }

      // Login the user
      req.login(user, (err) => {
        if (err) {
          console.error('Login error after Twitter auth:', err);
          return res.redirect('/?error=login_failed');
        }
        
        // Clean up session data
        delete (req.session as any).twitterCodeVerifier;
        delete (req.session as any).twitterState;
        
        console.log('Twitter OAuth login successful');
        res.redirect('/');
      });

    } catch (error) {
      console.error('Twitter OAuth callback error:', error);
      console.error('Error stack:', (error as Error).stack);
      res.redirect('/?error=twitter_auth_failed&message=' + encodeURIComponent((error as Error).message));
    }
  });

  // Fallback Twitter OAuth routes using traditional passport strategy
  app.get('/auth/twitter/fallback', (req: Request, res: Response, next) => {
    console.log('Twitter fallback OAuth route accessed');
    passport.authenticate('twitter-fallback')(req, res, next);
  });

  app.get('/auth/twitter/fallback/callback',
    passport.authenticate('twitter-fallback', { 
      failureRedirect: '/?error=twitter_fallback_failed' 
    }),
    (req: Request, res: Response) => {
      console.log('Twitter fallback OAuth callback success');
      res.redirect('/');
    }
  );

  // Logout endpoint
  app.post('/auth/logout', (req: Request, res: Response) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: 'Logout failed' });
      }
      res.json({ message: 'Logout successful' });
    });
  });

  // Get current user endpoint
  app.get('/auth/me', (req: Request, res: Response) => {
    console.log('Auth check - Session ID:', req.sessionID);
    console.log('Auth check - Is authenticated:', req.isAuthenticated());
    console.log('Auth check - User exists:', !!req.user);
    console.log('Auth check - Session data:', req.session);
    console.log('Auth check - Host:', req.get('Host'));
    
    if (req.isAuthenticated() && req.user) {
      const user = req.user as any;
      console.log('Auth check - User details:', { 
        id: user.id, 
        email: user.email, 
        displayName: user.displayName, 
        avatar: user.avatar, 
        provider: user.provider 
      });
      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatar: user.avatar,
          provider: user.provider
        }
      });
    } else {
      console.log('Auth check - Not authenticated, sending 401');
      res.status(401).json({ message: 'Not authenticated' });
    }
  });

  // Update display name endpoint
  app.post('/auth/update-display-name', async (req: Request, res: Response) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    try {
      const { displayName } = req.body;
      
      if (!displayName || typeof displayName !== 'string') {
        return res.status(400).json({ message: 'Display name is required' });
      }

      const trimmedDisplayName = displayName.trim();
      
      if (trimmedDisplayName.length < 2 || trimmedDisplayName.length > 50) {
        return res.status(400).json({ message: 'Display name must be between 2 and 50 characters' });
      }

      const user = req.user as any;

      // Check if another user already has this display name
      const existingUserWithDisplayName = await storage.getUserByDisplayName(trimmedDisplayName);
      if (existingUserWithDisplayName && existingUserWithDisplayName.id !== user.id) {
        return res.status(400).json({ message: 'This trader name is already taken. Please choose a different one.' });
      }
      
      // Update the user in the database
      const updatedUser = await storage.updateUserDisplayName(user.id, trimmedDisplayName);
      
      if (!updatedUser) {
        return res.status(500).json({ message: 'Failed to update display name' });
      }

      // Update the session user object
      req.user = updatedUser;

      console.log('Display name updated successfully for user:', updatedUser.id, 'New name:', trimmedDisplayName);
      
      res.json({ 
        message: 'Display name updated successfully',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          displayName: updatedUser.displayName,
          avatar: updatedUser.avatar,
          provider: updatedUser.provider
        }
      });

    } catch (error) {
      console.error('Update display name error:', error);
      console.error('Error details:', (error as Error).stack);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Check authentication status
  app.get('/auth/status', (req: Request, res: Response) => {
    res.json({ 
      isAuthenticated: req.isAuthenticated(),
      user: req.isAuthenticated() ? {
        id: (req.user as any).id,
        username: (req.user as any).username,
        displayName: (req.user as any).displayName,
        avatar: (req.user as any).avatar
      } : null
    });
  });
}