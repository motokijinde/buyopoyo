export interface RankingEntry {
  rank: number;
  name: string;
  score: number;
  timestamp: string;
}

export interface RankingResponse {
  ok: boolean;
  error?: string;
  rankings: RankingEntry[];
}

const API_URL = import.meta.env.VITE_RANKING_API_URL as string | undefined;
const TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function fetchRankings(): Promise<RankingResponse> {
  if (!API_URL) throw new Error("no_api_url");
  const res = await fetchWithTimeout(API_URL);
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json() as Promise<RankingResponse>;
}

export async function submitScore(
  name: string,
  score: number,
  sessionId: string,
): Promise<RankingResponse> {
  if (!API_URL) throw new Error("no_api_url");
  // GAS の POST はリダイレクト時に GET に変わる問題があるため GET パラメータで送る
  const params = new URLSearchParams({ action: "submit", name, score: String(score), sessionId });
  const res = await fetchWithTimeout(`${API_URL}?${params}`);
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json() as Promise<RankingResponse>;
}
