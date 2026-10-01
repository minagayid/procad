import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, reconcile, scoreRisk, transitionCase, verifyEventChain } from '../src/compliance-engine.js';

test('creates and verifies a tamper-evident canonical event chain', () => {
  const first = createEvent({ transaction_id: 'TX-1', organization_id: 'ORG-1', event_type: 'service.created', entity_id: 'SRV-1' });
  const second = createEvent({ transaction_id: 'TX-1', organization_id: 'ORG-1', event_type: 'invoice.issued', entity_id: 'INV-1', amount: 100, previous_event_hash: first.event_hash });
  assert.equal(verifyEventChain([first, second]).chain_verified, true);
  second.amount = 101;
  assert.equal(verifyEventChain([first, second]).chain_verified, false);
});

test('reconciles missing invoices, payment mismatches, duplicates, and inventory variance', () => {
  const result = reconcile({ organization_id: 'ORG-1', services: [{ id: 'S1', transaction_id: 'TX-1' }], invoices: [{ id: 'I1', transaction_id: 'TX-2', invoice_number: 'INV-1', amount: 100, issue_date: '2026-10-01' }, { id: 'I2', transaction_id: 'TX-2', invoice_number: 'INV-1', amount: 100, issue_date: '2026-10-01' }], payments: [{ id: 'P1', transaction_id: 'TX-2', amount: 60 }], inventory: [{ id: 'M1', transaction_id: 'TX-3', purchased: 100, consumed: 80, returned: 5, actual: 7 }] });
  assert.deepEqual(result.signals.map((item) => item.rule_id).sort(), ['DUPLICATE_INVOICE', 'INVENTORY_PRODUCTION_VARIANCE', 'INVOICE_PAYMENT_MISMATCH', 'SERVICE_WITHOUT_INVOICE']);
});

test('returns explainable weighted risk and allows only governed transitions', () => {
  const result = scoreRisk([{ rule_id: 'PAYMENT_WITHOUT_INVOICE', severity: 'high' }]);
  assert.equal(result.band, 'routine');
  assert.deepEqual(result.reason, ['PAYMENT_WITHOUT_INVOICE']);
  assert.equal(transitionCase('OPEN', 'TRIAGED').to, 'TRIAGED');
  assert.throws(() => transitionCase('OPEN', 'RESOLVED'), /Invalid governance transition/);
});
