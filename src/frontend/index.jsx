import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, Heading, Inline, Label, Lozenge, SectionMessage, Spinner, Stack, Text, Textfield,
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

function App() {
  const context = useProductContext();
  const [passport, setPassport] = useState(null);
  const [criteriaInput, setCriteriaInput] = useState('');
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [canManageWebhook, setCanManageWebhook] = useState(false);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const issueKey = context?.extension?.issue?.key ?? context?.platformContext?.issueKey;

  const refresh = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const data = await invoke('getPassport');
      setPassport(data);
      setCriteriaInput((data.requiredCriteria ?? []).join(', '));
    } catch (error) {
      setMessage(error?.message ?? 'Unable to load the Evidence Passport');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { if (issueKey) refresh(); }, [issueKey, refresh]);

  async function saveCriteria() {
    const criteria = criteriaInput.split(',').map((value) => value.trim()).filter(Boolean);
    setBusy(true);
    setMessage('');
    try {
      await invoke('saveCriteria', { criteria });
      await refresh();
      setMessage('Required criteria saved.');
    } catch (error) { setMessage(error?.message ?? 'Unable to save criteria'); }
    finally { setBusy(false); }
  }

  async function rotateSecret() {
    setBusy(true);
    setMessage('');
    setSecret('');
    try {
      const result = await invoke('rotateWebhookSecret');
      setSecret(result.secret);
      setWebhookConfigured(true);
      setMessage(result.previousValidUntil ? 'Secret rotated. The previous secret remains valid for 15 minutes.' : 'Signing secret created. Copy it now; it will not be shown again.');
    } catch (error) { setMessage(error?.message ?? 'Unable to create signing secret'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    invoke('getWebhookStatus').then((status) => {
      setCanManageWebhook(true);
      setWebhookConfigured(status.configured);
    }).catch(() => setCanManageWebhook(false));
  }, []);

  if (!issueKey || busy && !passport) return <Box padding="space.200"><Spinner /></Box>;
  const status = passport?.verdict?.status ?? 'INDETERMINATE';
  const appearance = status === 'PASS' ? 'success' : status === 'FAIL' ? 'danger' : 'neutral';

  return (
    <Box padding="space.200">
      <Stack space="space.200">
        <Inline alignBlock="center" spread="space-between">
          <Heading size="medium">Evidence Passport</Heading>
          <Lozenge appearance={appearance}>{status}</Lozenge>
        </Inline>
        <Text>Issue: {issueKey}</Text>
        {passport && <Text>{passport.verdict.reason?.replaceAll('_', ' ')}</Text>}
        {passport?.verdict?.missingCriteria?.length > 0 && <Text>Missing: {passport.verdict.missingCriteria.join(', ')}</Text>}
        {passport?.verdict?.failedCriteria?.length > 0 && <Text>Failed: {passport.verdict.failedCriteria.join(', ')}</Text>}
        {passport?.verdict?.unmatchedCriteria?.length > 0 && <Text>Unmatched: {passport.verdict.unmatchedCriteria.join(', ')}</Text>}
        <Heading size="small">Required criteria</Heading>
        <Label labelFor="proofline-criteria">Comma-separated criterion keys</Label>
        <Textfield id="proofline-criteria" placeholder="build, unit-tests, security-scan" value={criteriaInput} onChange={(event) => setCriteriaInput(event.target.value)} />
        <Text>Leave this field empty to clear the policy; an empty policy remains INDETERMINATE.</Text>
        <Inline>
          <Button appearance="primary" onClick={saveCriteria} isDisabled={busy}>Save criteria</Button>
          <Button onClick={refresh} isDisabled={busy}>Refresh</Button>
        </Inline>
        <Heading size="small">Evidence ({passport?.evidenceCount ?? 0})</Heading>
        {passport?.evidence?.length ? passport.evidence.map((item) => (
          <Box key={item.evidenceId} padding="space.100">
            <Stack space="space.050">
              <Inline alignBlock="center" spread="space-between">
                <Text>{item.criterionKey}</Text>
                <Lozenge appearance={item.outcome === 'PASS' ? 'success' : 'danger'}>{item.outcome}</Lozenge>
              </Inline>
              <Text>{item.sourceRunId} · {item.observedAt}</Text>
              <Text>{item.summary ?? item.evidenceId}</Text>
            </Stack>
          </Box>
        )) : <Text>No CI verification evidence has been received.</Text>}
        {canManageWebhook && <>
          <Heading size="small">GitHub Actions connection</Heading>
          <Text>{webhookConfigured ? 'A signing secret is configured for this Forge installation.' : 'No signing secret is configured yet.'}</Text>
          <Button onClick={rotateSecret} isDisabled={busy}>{webhookConfigured ? 'Rotate signing secret' : 'Create signing secret'}</Button>
          {secret && <SectionMessage appearance="warning"><Text>Copy this secret into the GitHub Actions secret PROOFLINE_WEBHOOK_SECRET. It is displayed only once: {secret}</Text></SectionMessage>}
        </>}
        {message && <SectionMessage appearance="information"><Text>{message}</Text></SectionMessage>}
      </Stack>
    </Box>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
