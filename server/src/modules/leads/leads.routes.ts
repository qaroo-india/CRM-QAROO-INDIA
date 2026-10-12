/**
 * GET   /leads              leads:read     paginated list + filters
 * GET   /leads/export       leads:export   ?format=xlsx|csv + list filters
 * GET   /leads/board        leads:read     Kanban columns
 * GET   /leads/duplicates   leads:read     ?phone&email&excludeId
 * GET   /leads/:id          leads:read     detail + activity timeline
 * POST  /leads              leads:write
 * PUT   /leads/:id          leads:write    full replace
 * POST  /leads/:id/status   leads:write    pipeline move
 * POST  /leads/:id/activities  leads:write log a call / note / meeting
 * POST  /leads/assign       leads:assign   bulk assign to a counsellor
 */

import { duplicateQuerySchema, leadListQuerySchema } from '@ims/shared';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import { db } from '../../db';
import { requirePermission } from '../../middleware/auth';
import { recordAudit } from '../../services/audit';
import { instituteToday } from '../../services/clock';
import { findDuplicates } from '../../services/duplicates';
import { toCsv } from '../../services/tabular';
import { contextFrom } from '../../utils/context';
import { created, ok } from '../../utils/respond';
import { sendDownload } from '../../utils/sendFile';
import { paramId, parseQuery } from '../../utils/validate';
import { sanitizeCell } from '../reports/render/excel';
import {
  addLeadActivity,
  assignLeads,
  changeLeadStatus,
  createLead,
  getLead,
  leadBoard,
  leadsForExport,
  listLeads,
  updateLead,
} from './leads.service';

export const leadsRouter = Router();

leadsRouter.get('/', requirePermission('leads:read'), (req, res) => {
  ok(res, listLeads(parseQuery(leadListQuerySchema, req)));
});

/** Excel or CSV of every lead matching the list filters (capped at 10,000). */
leadsRouter.get('/export', requirePermission('leads:export'), async (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const query = parseQuery(leadListQuerySchema, req);
  const { rows, total } = leadsForExport(query);
  const ctx = contextFrom(req);
  const headers = ['Lead code', 'Name', 'Phone', 'Email', 'Enquiry date', 'Source', 'Campaign', 'Ad reference', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM term', 'UTM content', 'Course', 'Counsellor', 'Follow-up date', 'Priority', 'Status', 'Lost reason', 'Converted on', 'Notes'];
  const values = rows.map((l) => [l.leadCode, l.name, l.phone, l.email, l.enquiryDate, l.sourceName, l.campaignName, l.adReference, l.utmSource, l.utmMedium, l.utmCampaign, l.utmTerm, l.utmContent, l.courseName, l.counsellorName, l.followUpDate, l.priority, l.status.replace(/_/g, ' '), l.lostReason, l.convertedOn, l.notes]);
  const stamp = instituteToday();
  recordAudit(db, ctx, { action: 'export', entityType: 'lead', summary: `Exported ${rows.length} of ${total} leads as ${format.toUpperCase()}`, after: { ...req.query } });
  if (format === 'csv') {
    sendDownload(res, { buffer: Buffer.from(toCsv(headers, values), 'utf8'), fileName: `leads-${stamp}.csv`, mimeType: 'text/csv; charset=utf-8' });
    return;
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Institute OS';
  const ws = wb.addWorksheet('Leads');
  ws.addRow(headers).font = { bold: true };
  for (const row of values) ws.addRow(row.map((v) => (typeof v === 'string' ? sanitizeCell(v) : v)));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns.forEach((c) => (c.width = 16));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
  if (total > rows.length) ws.addRow([`Showing ${rows.length} of ${total} leads. Narrow the filters to export the rest.`]);
  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  sendDownload(res, { buffer, fileName: `leads-${stamp}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
});

leadsRouter.get('/board', requirePermission('leads:read'), (req, res) => {
  ok(res, leadBoard(parseQuery(leadListQuerySchema, req)));
});

leadsRouter.get('/duplicates', requirePermission('leads:read'), (req, res) => {
  const query = parseQuery(duplicateQuerySchema, req);
  ok(res, findDuplicates({ phone: query.phone, email: query.email, excludeLeadId: query.excludeId }));
});

leadsRouter.get('/:id', requirePermission('leads:read'), (req, res) => {
  ok(res, getLead(paramId(req)));
});

leadsRouter.post('/assign', requirePermission('leads:assign'), (req, res) => {
  ok(res, assignLeads(contextFrom(req), req.body));
});

leadsRouter.post('/', requirePermission('leads:write'), (req, res) => {
  created(res, createLead(contextFrom(req), req.body));
});

leadsRouter.put('/:id', requirePermission('leads:write'), (req, res) => {
  ok(res, updateLead(contextFrom(req), paramId(req), req.body));
});

leadsRouter.post('/:id/status', requirePermission('leads:write'), (req, res) => {
  ok(res, changeLeadStatus(contextFrom(req), paramId(req), req.body));
});

leadsRouter.post('/:id/activities', requirePermission('leads:write'), (req, res) => {
  ok(res, addLeadActivity(contextFrom(req), paramId(req), req.body));
});
