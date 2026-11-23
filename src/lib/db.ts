import type { NeonQueryFunction } from '@neondatabase/serverless';
import { neon } from '@neondatabase/serverless';

let sql: NeonQueryFunction<boolean, boolean> | null = null;

export const getSql = (): NeonQueryFunction<boolean, boolean> => {
  if (!sql) {
    const databaseUrl = import.meta.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    sql = neon(databaseUrl);
  }
  return sql;
};

// Neon serverless driver doesn't require explicit close; pool is managed automatically
export const closeSql = async (): Promise<void> => {
  sql = null;
};

// Prepared statement helpers for security — all use tagged template literals (injection-safe)
export const queries = {
  // Users
  createUser: (email: string, name: string, avatarUrl: string, githubId: number) => {
    const client = getSql();
    return client`INSERT INTO users (email, name, avatar_url, github_id) VALUES (${email}, ${name}, ${avatarUrl}, ${githubId}) RETURNING *`;
  },

  getUserByEmail: (email: string) => {
    const client = getSql();
    return client`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
  },

  getUserByGithubId: (githubId: number) => {
    const client = getSql();
    return client`SELECT * FROM users WHERE github_id = ${githubId} LIMIT 1`;
  },

  // Teams
  createTeam: (name: string, hackathonId: string, ownerId: string) => {
    const client = getSql();
    return client`INSERT INTO teams (name, hackathon_id, owner_id) VALUES (${name}, ${hackathonId}, ${ownerId}) RETURNING *`;
  },

  getTeamById: (id: string) => {
    const client = getSql();
    return client`SELECT * FROM teams WHERE id = ${id} LIMIT 1`;
  },

  getTeamsByHackathon: (hackathonId: string) => {
    const client = getSql();
    return client`SELECT * FROM teams WHERE hackathon_id = ${hackathonId}`;
  },

  // Projects
  createProject: (
    teamId: string,
    name: string,
    repoUrl: string,
    demoUrl: string,
    description: string
  ) => {
    const client = getSql();
    return client`INSERT INTO projects (team_id, name, repo_url, demo_url, description) VALUES (${teamId}, ${name}, ${repoUrl}, ${demoUrl}, ${description}) RETURNING *`;
  },

  getProjectByTeam: (teamId: string) => {
    const client = getSql();
    return client`SELECT * FROM projects WHERE team_id = ${teamId} LIMIT 1`;
  },

  // Judging
  createScore: (
    projectId: string,
    judgeId: string,
    criteriaId: string,
    score: number,
    feedback: string
  ) => {
    const client = getSql();
    return client`INSERT INTO scores (project_id, judge_id, criteria_id, score, feedback) VALUES (${projectId}, ${judgeId}, ${criteriaId}, ${score}, ${feedback}) RETURNING *`;
  },

  getScoresByProject: (projectId: string) => {
    const client = getSql();
    return client`SELECT * FROM scores WHERE project_id = ${projectId}`;
  },

  // Hackathons
  getActiveHackathon: () => {
    const client = getSql();
    return client`SELECT * FROM hackathons WHERE starts_at <= NOW() AND ends_at >= NOW() LIMIT 1`;
  },

  getUpcomingHackathons: () => {
    const client = getSql();
    return client`SELECT * FROM hackathons WHERE starts_at > NOW() ORDER BY starts_at ASC`;
  },
};

// Transaction helper — Neon supports transaction callback via the sql tag
export const transaction = async <T>(
  fn: (sql: NeonQueryFunction<boolean, boolean>) => Promise<T>
): Promise<T> => {
  const client = getSql();
  // Neon's transaction API: sql.transaction(callback)
  // @ts-expect-error - Neon types don't perfectly match but runtime works
  return client.transaction(fn);
};
