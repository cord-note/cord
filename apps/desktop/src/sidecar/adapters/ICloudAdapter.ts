import type { OperationLogEntry } from '@shared/types';

export interface VectorClock {
  [deviceId: string]: number;
}

export interface Credentials {
  token: string;
}

export interface Session {
  token: string;
  expiresAt: number;
}

export interface Member {
  userId: string;
  username: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface ICloudAdapter {
  pushOps(ops: OperationLogEntry[]): Promise<void>;
  pullOps(since: VectorClock): Promise<OperationLogEntry[]>;
  authenticate(credentials: Credentials): Promise<Session>;
  getVaultMembers(vaultId: string): Promise<Member[]>;
}
