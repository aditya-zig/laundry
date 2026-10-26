import React, { useEffect, useState } from 'react';
import type { v2 } from '@laundry/contracts';
import type { PartnerApi } from '../session/partner-api';
import { NoticeBox, PrimaryButton } from '../ui';
import { AssignmentAcceptance, type AcceptanceState } from './acceptance';

export function AssignmentAcceptancePanel(props: {
  api: PartnerApi; job: v2.RiderJob; onConfirmed: () => void; onRefresh: () => Promise<void>;
}) {
  const [state, setState] = useState<AcceptanceState>({ phase: 'checking' });
  const [controller, setController] = useState<AssignmentAcceptance | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const { api, job, onConfirmed } = props;
  useEffect(() => {
    const next = new AssignmentAcceptance(api, job, value => {
      setState(value);
      if (value.phase === 'confirmed') onConfirmed();
    });
    setController(next);
    void next.checkQueue();
    return () => next.dispose();
  }, [api, job.id, job.version, onConfirmed]);
  return <>
    <NoticeBox title={state.phase === 'confirmed' ? 'Assignment acknowledged' : 'Confirm your active assignment'}
      body={state.message ?? 'Confirm that you are handling this task before recording a physical handover. This does not record pickup, return or delivery.'}
      tone={state.phase === 'confirmed' ? 'success' : 'warning'} />
    {state.phase !== 'confirmed' ? <PrimaryButton
      label={state.phase === 'pending' ? 'Retry retained acknowledgement' : 'Confirm assignment online'}
      accessibilityLabel="Confirm rider assignment" busy={state.phase === 'busy'}
      disabled={!['ready', 'pending', 'rejected'].includes(state.phase)} onPress={() => void controller?.confirm()} /> : null}
    {state.phase === 'blocked' ? <PrimaryButton label="Check acceptance journal" tone="quiet" onPress={() => void controller?.checkQueue()} /> : null}
    {['blocked', 'rejected'].includes(state.phase) ? <PrimaryButton label="Refresh assignment" tone="quiet" onPress={() => {
      setReadError(null);
      void props.onRefresh().catch(() => setReadError('The current assignment could not be loaded. Contact dispatch before handling the bags.'));
    }} /> : null}
    {readError ? <NoticeBox title="Assignment not refreshed" body={readError} tone="warning" /> : null}
  </>;
}
