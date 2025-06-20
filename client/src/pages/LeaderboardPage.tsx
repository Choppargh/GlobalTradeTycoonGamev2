import React, { useState, useEffect } from 'react';

interface LeaderboardEntry {
  id: number;
  username: string;
  displayName?: string;
  score: number;
  weekNumber: number;
  createdAt: string;
}

export default function LeaderboardPage() {
  const [scores, setScores] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/scores', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setScores(data);
      } else {
        setError('Failed to load leaderboard');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatScore = (score: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(score);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-dashed rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-700">Loading leaderboard...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8" style={{
      backgroundImage: `url('/images/GTC_Background.png')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    }}>
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white drop-shadow-lg">Global Leaderboard</h1>
          <button 
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 bg-white/90 text-gray-800 rounded-2xl font-medium hover:bg-white transition-colors shadow-lg"
          >
            Back to Home
          </button>
        </div>

        {error ? (
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-lg p-8 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button 
              onClick={fetchLeaderboard}
              className="px-6 py-3 bg-blue-400 text-white rounded-2xl hover:bg-blue-500 font-semibold shadow-md"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-lg">
            <div className="p-8 border-b border-gray-200 rounded-t-3xl">
              <h2 className="text-xl font-semibold">Top Traders This Week</h2>
            </div>
            <div className="p-8">
              {scores.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-lg">No scores yet this week!</p>
                  <p className="text-gray-400">Be the first to complete a game and claim the top spot.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {scores.map((entry, index) => (
                    <div
                      key={entry.id}
                      className={`flex items-center justify-between p-4 rounded-2xl ${
                        index === 0 ? 'bg-yellow-50 border-2 border-yellow-200' :
                        index === 1 ? 'bg-gray-50 border-2 border-gray-200' :
                        index === 2 ? 'bg-orange-50 border-2 border-orange-200' :
                        'bg-white border border-gray-100'
                      }`}
                    >
                      <div className="flex items-center space-x-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                          index === 0 ? 'bg-yellow-400 text-yellow-900' :
                          index === 1 ? 'bg-gray-400 text-gray-900' :
                          index === 2 ? 'bg-orange-400 text-orange-900' :
                          'bg-blue-100 text-blue-900'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{entry.displayName || entry.username}</p>
                          <p className="text-sm text-gray-500">{formatDate(entry.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg text-green-600">{formatScore(entry.score)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-white mb-4 bg-black/30 backdrop-blur-sm rounded-lg p-3">
            Leaderboard resets every Monday at midnight UTC
          </p>
          <button 
            onClick={() => window.location.href = '/game'}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 shadow-md"
          >
            Play Now
          </button>
        </div>
      </div>
    </div>
  );
}