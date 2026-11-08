// Page mutations the fixture can serve. Each asserts that it really changed the page, so a "pass" is never vacuous.
import { fixturePage } from '../../apps/fixture-site/page.js';

export type MutationId = 'none' | 'rename-export' | 'decoy-export' | 'reorder-fields';
export const MUTATIONS: { id: MutationId; description: string }[] = [
  { id: 'none', description: 'Unchanged fixture.' },
  { id: 'rename-export', description: 'The Export CSV button is relabeled "Download report".' },
  { id: 'decoy-export', description: 'A second, identical "Export CSV" submit button appears in the page header.' },
  { id: 'reorder-fields', description: 'The start and end date fields swap places.' },
];

function replaceOnce(page: string, from: string, to: string, what: string) {
  const index = page.indexOf(from);
  if (index < 0 || page.indexOf(from, index + 1) >= 0) throw new Error(`mutation anchor not unique: ${what}`);
  return page.slice(0, index) + to + page.slice(index + from.length);
}

export function mutate(id: MutationId): string {
  switch (id) {
    case 'none': return fixturePage;
    case 'rename-export': return replaceOnce(fixturePage, '>Export CSV</button>', '>Download report</button>', 'export label');
    case 'decoy-export': return replaceOnce(fixturePage, '<span class="badge">SYNTHETIC DEMO</span>',
      '<form action="/export" style="margin:0"><input type="hidden" name="team" value="red"><input type="hidden" name="start" value="2026-10-26"><input type="hidden" name="end" value="2026-11-02"><button class="primary">Export CSV</button></form><span class="badge">SYNTHETIC DEMO</span>', 'header badge');
    case 'reorder-fields': {
      const startField = '<div><label for="start">Start inclusive</label><input id="start" name="start" value="2026-10-26" required pattern="2026-[0-9]{2}-[0-9]{2}" aria-describedby="date-help"></div>';
      const endField = '<div><label for="end">End exclusive</label><input id="end" name="end" value="2026-11-02" required pattern="2026-[0-9]{2}-[0-9]{2}" aria-describedby="date-help"></div>';
      return replaceOnce(fixturePage, startField + endField, endField + startField, 'date fields');
    }
  }
}
