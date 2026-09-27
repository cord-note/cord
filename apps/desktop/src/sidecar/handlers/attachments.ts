import { Router, json } from '../router';
import type { AttachmentService } from '../services/AttachmentService';
import type { AuthService } from '../services/AuthService';
import type { CreateAttachmentInput } from '@shared/types';

export function registerAttachmentHandlers(router: Router, attachments: AttachmentService, auth: AuthService): void {
  router.post('/attachments', async (req) => {
    auth.requireSession();
    const data = await req.json() as CreateAttachmentInput;
    return json(attachments.create(data), 201);
  });
}
