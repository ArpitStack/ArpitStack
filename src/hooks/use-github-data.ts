import { useState, useEffect } from 'react';

interface GitHubStats {
  stars: number;
  forks: number;
}

const REPO_MAP: Record<string, string> = {
  'SecretStack': 'ArpitStack/SecretStack',
  'CloudStack': 'ArpitStack/CloudStack',
  'VaultStack': 'ArpitStack/VaultStack',
  'ScaleStack': 'ArpitStack/ScaleStack',
  'CheatStack': 'ArpitStack/CheatStack',
  'CSM-SSO-Plugin': 'ArpitStack/CSM-SSO-Plugin'
};

const MOCK_STATS: Record<string, GitHubStats> = {
  'SecretStack': { stars: 124, forks: 15 },
  'CloudStack': { stars: 89, forks: 8 },
  'VaultStack': { stars: 256, forks: 34 },
  'ScaleStack': { stars: 67, forks: 5 },
  'CheatStack': { stars: 432, forks: 89 },
};

export function useGitHubStats(projectName: string) {
  const [stats, setStats] = useState<GitHubStats>({ stars: 0, forks: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const repo = REPO_MAP[projectName];
    if (!repo) {
      setLoading(false);
      return;
    }

    const fetchStats = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}`);
        if (!response.ok) {
          // Fallback to mock data on error (e.g. rate limit)
          console.warn(`Note: Using mock stats for ${projectName} (GitHub API limit reached)`);
          if (MOCK_STATS[projectName]) {
            setStats(MOCK_STATS[projectName]);
          }
          return;
        }
        const data = await response.json();
        setStats({
          stars: data.stargazers_count,
          forks: data.forks_count
        });
      } catch (error) {
        console.error(`Error fetching stats for ${projectName}:`, error);
        // Fallback on network error
        if (MOCK_STATS[projectName]) {
          setStats(MOCK_STATS[projectName]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [projectName]);

  return { stats, loading };
}
