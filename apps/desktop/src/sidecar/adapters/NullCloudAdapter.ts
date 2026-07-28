import type {
  ICloudAdapter,
  VectorClock,
  Credentials,
  Session,
  Member,
} from './ICloudAdapter';
import type { OperationLogEntry } from '@shared/types';

export class NullCloudAdapter implements ICloudAdapter {
  async pushOps(_ops: OperationLogEntry[]): Promise<void> {}

  async pullOps(_since: VectorClock): Promise<OperationLogEntry[]> {
    return [];
  }

  async authenticate(_credentials: Credentials): Promise<Session> {
    throw new Error('NullCloudAdapter: no cloud in Phase 1');
  }

  async getVaultMembers(_vaultId: string): Promise<Member[]> {
    return [];
  }
}
