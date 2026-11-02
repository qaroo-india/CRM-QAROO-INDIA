/**
 * POST /import/:entity/preview   data:import + <entity>:write   multipart "file" (.csv or .xlsx)
 * POST /import/:entity/commit    data:import + <entity>:write   { token, rows, allowDuplicates }
 * GET  /import/:entity/template  data:import                    CSV with the expected headers
 *
 * :entity is "leads" or "students".
 */

import { hasPermission, IMPORT_ENTITIES, type ImportEntity } from '@ims/shared';
import { Router, type Request } from 'express';
import { requirePermission } from '../../middleware/auth';
import { ApiError } from '../../utils/ApiError';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { toCsv } from '../../services/tabular';
import { uploadSingle } from '../documents/documents.routes';
import { commitImport, previewImport } from './import.service';

export const importRouter = Router();

function entityFrom(req: Request): ImportEntity {
  const entity = req.params.entity as ImportEntity;
  if (!(IMPORT_ENTITIES as readonly string[]).includes(entity)) throw ApiError.notFound('Import type');
  const ctx = contextFrom(req);
  if (!hasPermission(ctx.permissions, entity === 'leads' ? 'leads:write' : 'students:write')) {
    throw ApiError.forbidden(`Importing ${entity} also needs permission to create ${entity}.`);
  }
  return entity;
}

const TEMPLATES: Record<ImportEntity, { headers: string[]; example: string[] }> = {
  leads: {
    headers: ['Name', 'Phone', 'Email', 'Enquiry date', 'Source', 'Course', 'Counsellor', 'Follow-up date', 'Priority', 'Campaign', 'UTM source', 'UTM medium', 'UTM campaign', 'Notes'],
    example: ['Asha Verma', '98765 43210', 'asha@example.com', '12/10/2026', 'Website', 'Data Analytics', '', '15/10/2026', 'high', 'Diwali offer', 'google', 'cpc', 'diwali-2026', 'Wants weekend batch'],
  },
  students: {
    headers: ['Full name', 'Phone', 'Email', 'Address', 'City', 'Date of birth', 'Emergency contact name', 'Emergency contact phone', 'Notes'],
    example: ['Asha Verma', '98765 43210', 'asha@example.com', '12 MG Road', 'Chennai', '21/04/2003', 'R. Verma', '98765 00000', ''],
  },
};

importRouter.get('/:entity/template', requirePermission('data:import'), (req, res) => {
  const entity = req.params.entity as ImportEntity;
  const template = TEMPLATES[entity];
  if (!template) throw ApiError.notFound('Import type');
  sendDownload(res, { buffer: Buffer.from(toCsv(template.headers, [template.example]), 'utf8'), fileName: `${entity}-import-template.csv`, mimeType: 'text/csv; charset=utf-8' });
});

importRouter.post('/:entity/preview', requirePermission('data:import'), uploadSingle, async (req, res) => {
  ok(res, await previewImport(contextFrom(req), entityFrom(req), req.file));
});

importRouter.post('/:entity/commit', requirePermission('data:import'), async (req, res) => {
  created(res, await commitImport(contextFrom(req), entityFrom(req), req.body));
});
