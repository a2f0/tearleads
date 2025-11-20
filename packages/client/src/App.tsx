import { useState, useEffect } from 'react';
import { formatDate, type HealthData } from '@rapid/shared';
import './App.css';

function App() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/health');

      if (!response.ok) {
        throw new Error('Failed to fetch health status');
      }

      const data: HealthData = await response.json();
      setHealth(data);
    } catch (err) {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <h1>Rapid Monorepo</h1>

      <div className="section">
        <h2>API Health Check</h2>
        {loading && <p>Loading...</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && health && (
          <div className="health-info">
            <p>
              <strong>Status:</strong> Healthy
            </p>
            <p>
              <strong>Timestamp:</strong> {health.timestamp}
            </p>
            <p>
              <strong>Uptime:</strong> {health.uptime.toFixed(2)}s
            </p>
            <p>
              <strong>Current Time (formatted):</strong> {formatDate(new Date())}
            </p>
          </div>
        )}
        <button onClick={fetchHealth} disabled={loading}>
          Refresh
        </button>
      </div>
    </div>
  );
}

export default App;
