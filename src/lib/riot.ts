interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

interface ChallengeConfig {
  id: number;
  localizedNames: Record<string, { name: string; description: string; shortDescription: string }>;
  state: string;
  leaderboard?: boolean;
  thresholds: Record<string, number>;
  category?: string;
  tags?: Record<string, string[]>;
}

interface PlayerChallengeData {
  totalPoints: { level: string; current: number; max: number; percentile: number };
  categoryPoints: Record<string, { level: string; current: number; max: number; percentile: number }>;
  challenges: {
    challengeId: number;
    percentile: number;
    level: string;
    value: number;
    achievedTime?: number;
    position?: number;
    playersInLevel?: number;
  }[];
}

type PercentileMap = Record<string, Record<string, number>>;

// Rate limiter: 20 req/s burst, 100 req/120s sustained
const rateLimiter = {
  shortWindow: [] as number[],   // timestamps for 1s window
  longWindow: [] as number[],    // timestamps for 120s window
  async wait() {
    const now = Date.now();
    // Prune old entries
    this.shortWindow = this.shortWindow.filter(t => now - t < 1000);
    this.longWindow = this.longWindow.filter(t => now - t < 120000);

    // Wait if either limit is hit
    while (this.shortWindow.length >= 19 || this.longWindow.length >= 95) {
      const shortWait = this.shortWindow.length >= 19
        ? 1000 - (now - this.shortWindow[0]) : 0;
      const longWait = this.longWindow.length >= 95
        ? 120000 - (Date.now() - this.longWindow[0]) : 0;
      await new Promise(r => setTimeout(r, Math.max(shortWait, longWait, 50)));
      const updated = Date.now();
      this.shortWindow = this.shortWindow.filter(t => updated - t < 1000);
      this.longWindow = this.longWindow.filter(t => updated - t < 120000);
    }

    const ts = Date.now();
    this.shortWindow.push(ts);
    this.longWindow.push(ts);
  },
};

async function riotFetch(url: string, apiKey: string) {
  await rateLimiter.wait();
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Riot API error ${res.status}: ${text} (${url})`);
  }
  return res.json();
}

export async function getAccountByRiotId(apiKey: string, gameName: string, tagLine: string): Promise<RiotAccount> {
  return riotFetch(
    `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey
  );
}

export async function getChallengeConfigs(apiKey: string, region: string): Promise<ChallengeConfig[]> {
  return riotFetch(
    `https://${region}.api.riotgames.com/lol/challenges/v1/challenges/config`,
    apiKey
  );
}

export async function getPlayerChallengeData(apiKey: string, region: string, puuid: string): Promise<PlayerChallengeData> {
  return riotFetch(
    `https://${region}.api.riotgames.com/lol/challenges/v1/player-data/${puuid}`,
    apiKey
  );
}

export async function getChallengePercentiles(apiKey: string, region: string): Promise<PercentileMap> {
  return riotFetch(
    `https://${region}.api.riotgames.com/lol/challenges/v1/challenges/percentiles`,
    apiKey
  );
}

export async function getChallengeLeaderboardFloor(
  apiKey: string,
  region: string,
  challengeId: number,
  level: 'GRANDMASTER' | 'CHALLENGER'
): Promise<number | null> {
  try {
    if (level === 'GRANDMASTER') {
      // GM leaderboard returns bottom entries first — limit=1 gives the floor value
      const data = await riotFetch(
        `https://${region}.api.riotgames.com/lol/challenges/v1/challenges/${challengeId}/leaderboards/by-level/GRANDMASTER?limit=1`,
        apiKey
      );
      if (Array.isArray(data) && data.length > 0) return data[0].value;
    } else {
      // Challenger leaderboard returns top-first — get last entry from max page
      const data = await riotFetch(
        `https://${region}.api.riotgames.com/lol/challenges/v1/challenges/${challengeId}/leaderboards/by-level/CHALLENGER?limit=200`,
        apiKey
      );
      if (Array.isArray(data) && data.length > 0) return data[data.length - 1].value;
    }
  } catch {
    // Challenge may not have a leaderboard for this level
  }
  return null;
}

export async function getMatchIds(apiKey: string, puuid: string, count = 10): Promise<string[]> {
  // Fetch from multiple queues in parallel to ensure all modes are included
  // Default = ranked/normal, 450 = ARAM, 900 = URF/rotating modes, 1700 = Arena
  const queries = [
    riotFetch(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`, apiKey),
    riotFetch(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}&queue=450`, apiKey),
    riotFetch(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}&queue=900`, apiKey),
    riotFetch(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}&queue=1700`, apiKey),
  ];
  const results = await Promise.all(queries);
  // Merge and deduplicate, return most recent first
  const all = [...new Set<string>(results.flat())];
  all.sort((a, b) => {
    // Match IDs are like NA1_5522749576 — higher number = more recent
    const numA = parseInt(a.split('_')[1]);
    const numB = parseInt(b.split('_')[1]);
    return numB - numA;
  });
  return all.slice(0, count * 2); // return more since we merged two lists
}

interface MatchParticipant {
  puuid: string;
  championName: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

interface MatchData {
  info: {
    gameMode: string;
    gameDuration: number;
    gameCreation: number;
    participants: MatchParticipant[];
  };
}

export async function getMatch(apiKey: string, matchId: string): Promise<MatchData> {
  return riotFetch(
    `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    apiKey
  );
}

export type { RiotAccount, ChallengeConfig, PlayerChallengeData, PercentileMap, MatchData };
