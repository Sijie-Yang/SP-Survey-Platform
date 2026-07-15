import { useState, useEffect } from 'react';

const GITHUB_API_URL = 'https://api.github.com/repos/Sijie-Yang/SP-Survey';
const REFRESH_MS = 5 * 60 * 1000;

/** Fetch stargazers_count for the SP-Survey repo (refreshes every 5 min). */
export function useGithubStars() {
  const [stars, setStars] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStars = async () => {
      try {
        const response = await fetch(GITHUB_API_URL);
        if (!response.ok) {
          if (!cancelled) setStars(null);
          return;
        }
        const data = await response.json();
        if (!cancelled) setStars(data.stargazers_count ?? null);
      } catch {
        if (!cancelled) setStars(null);
      }
    };

    fetchStars();
    const interval = setInterval(fetchStars, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return stars;
}
