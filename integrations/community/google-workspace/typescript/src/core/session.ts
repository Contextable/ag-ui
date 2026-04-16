import type { Session, UserConfig, HostApp } from "../types";

/**
 * Abstract session store interface.
 * Default implementation uses Firestore; can be swapped for testing or other backends.
 */
export interface SessionStore {
  getSession(userId: string, hostApp: HostApp): Promise<Session | null>;
  saveSession(userId: string, session: Session): Promise<void>;
  deleteSession(userId: string, hostApp: HostApp): Promise<void>;
  getConfig(userId: string): Promise<UserConfig | null>;
  saveConfig(userId: string, config: UserConfig): Promise<void>;
}

/**
 * Firestore-backed session store.
 */
export class FirestoreSessionStore implements SessionStore {
  private db: FirebaseFirestore.Firestore;

  constructor(db: FirebaseFirestore.Firestore) {
    this.db = db;
  }

  private sessionKey(userId: string, hostApp: HostApp): string {
    return `${userId}_${hostApp}`;
  }

  async getSession(
    userId: string,
    hostApp: HostApp,
  ): Promise<Session | null> {
    const doc = await this.db
      .collection("sessions")
      .doc(this.sessionKey(userId, hostApp))
      .get();
    return doc.exists ? (doc.data() as Session) : null;
  }

  async saveSession(userId: string, session: Session): Promise<void> {
    const key = this.sessionKey(userId, session.hostApp);
    await this.db.collection("sessions").doc(key).set(
      {
        ...session,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  }

  async deleteSession(userId: string, hostApp: HostApp): Promise<void> {
    await this.db
      .collection("sessions")
      .doc(this.sessionKey(userId, hostApp))
      .delete();
  }

  async getConfig(userId: string): Promise<UserConfig | null> {
    const doc = await this.db.collection("config").doc(userId).get();
    return doc.exists ? (doc.data() as UserConfig) : null;
  }

  async saveConfig(userId: string, config: UserConfig): Promise<void> {
    await this.db.collection("config").doc(userId).set(config, { merge: true });
  }
}

/**
 * In-memory session store for testing and local development.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();
  private configs = new Map<string, UserConfig>();

  private sessionKey(userId: string, hostApp: HostApp): string {
    return `${userId}_${hostApp}`;
  }

  async getSession(
    userId: string,
    hostApp: HostApp,
  ): Promise<Session | null> {
    return this.sessions.get(this.sessionKey(userId, hostApp)) ?? null;
  }

  async saveSession(userId: string, session: Session): Promise<void> {
    const key = this.sessionKey(userId, session.hostApp);
    this.sessions.set(key, { ...session, updatedAt: Date.now() });
  }

  async deleteSession(userId: string, hostApp: HostApp): Promise<void> {
    this.sessions.delete(this.sessionKey(userId, hostApp));
  }

  async getConfig(userId: string): Promise<UserConfig | null> {
    return this.configs.get(userId) ?? null;
  }

  async saveConfig(userId: string, config: UserConfig): Promise<void> {
    this.configs.set(userId, { ...config });
  }

  /** Test helper: clear all data */
  clear(): void {
    this.sessions.clear();
    this.configs.clear();
  }
}
