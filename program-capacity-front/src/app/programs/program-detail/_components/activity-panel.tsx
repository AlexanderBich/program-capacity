import { useState } from 'react';
import { ACTIVITY_VIEW_OPTIONS, type ActivityView } from '../_constants';
import { LedgerTable } from './ledger-table';
import { Panel } from './panel';
import { ReconciliationList } from './reconciliation-list';
import { SegmentedControl } from './segmented-control';

type ActivityPanelProps = {
  programId: string;
  programCurrency: string;
};

export function ActivityPanel({ programId, programCurrency }: ActivityPanelProps) {
  const [view, setView] = useState<ActivityView>('ledger');

  return (
    <Panel
      title="Activity"
      description="Every change to this program's capacity, and where it came from"
      actions={
        <SegmentedControl
          label="Activity view"
          value={view}
          options={ACTIVITY_VIEW_OPTIONS}
          onChange={setView}
        />
      }
    >
      {view === 'ledger' ? (
        <LedgerTable programId={programId} programCurrency={programCurrency} />
      ) : (
        <ReconciliationList programId={programId} programCurrency={programCurrency} />
      )}
    </Panel>
  );
}
