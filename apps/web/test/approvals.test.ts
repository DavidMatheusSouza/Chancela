import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;
delete process.env.APPROVALS_ADDRESS;
delete process.env.DATABASE_URL;
process.env.PUBLIC_BASE_URL = 'https://chancela.xyz';

const { authorize } = await import('../src/lib/authorize.js');
const { approve, registerApprover, ApprovalError } = await import('../src/lib/approvals.js');
const { execute } = await import('../src/lib/executor.js');
const { getRepository } = await import('../src/lib/store.js');
const { challengeFor, toBase64Url } = await import('../src/lib/webauthn-approval.js');

const DEMO_OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TRANSFER = { amount: 50_000, currency: 'USD', recipient: 'Acme Supplies' };
const CRED = 'Y3JlZC0x';
const passkey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

function assertionFor(decisionHash: `0x${string}`, key = passkey) {
  const clientData = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge: challengeFor(decisionHash), origin: 'https://chancela.xyz', crossOrigin: false }),
  );
  const auth = Buffer.concat([sha('chancela.xyz'), Buffer.from([0x1d, 0, 0, 0, 1])]);
  return {
    credentialId: CRED,
    authenticatorData: toBase64Url(auth),
    clientDataJSON: toBase64Url(clientData),
    signature: toBase64Url(sign('sha256', Buffer.concat([auth, sha(clientData)]), { key: key.privateKey, dsaEncoding: 'der' })),
  };
}

async function enrol() {
  vi.stubEnv('ALLOW_DEMO_APPROVER_ENROLMENT', 'true');
  const repo = await getRepository();
  await registerApprover(repo, DEMO_OWNER, {
    credentialId: CRED,
    publicKeySpki: toBase64Url(new Uint8Array(passkey.publicKey.export({ format: 'der', type: 'spki' }))),
  });
  return repo;
}

const stepUp = () => authorize({ agentId: 'TA-003', action: 'TRANSFER_FUNDS', parameters: TRANSFER });

afterEach(() => vi.unstubAllEnvs());

describe('owner approval of a step-up', () => {
  it('gives a REQUIRE_APPROVAL somewhere to be answered', async () => {
    const d = await stepUp();
    expect(d.decision).toBe('REQUIRE_APPROVAL');
    expect(d.approval).toMatchObject({ status: 'PENDING', url: `/api/approvals/${d.approval!.id}` });
    expect(d.approval!.id).toMatch(/^apr_[0-9a-f-]{36}$/);
    expect((await authorize({ agentId: 'TA-001', action: 'CREATE_CUSTOMER', parameters: { name: 'x' } })).approval).toBeUndefined();
  });

  it('turns into a signed ALLOW once the owner approves with the enrolled passkey', async () => {
    const repo = await enrol();
    const d = await stepUp();
    const { approval, decision } = await approve(repo, d.approval!.id, DEMO_OWNER, assertionFor(d.decisionHash as `0x${string}`));
    expect(approval.status).toBe('APPROVED');
    expect(approval.approvedDecisionId).toBe(decision.decisionId);
    expect(decision).toMatchObject({ decision: 'ALLOW', reasonCode: 'APPROVED_BY_OWNER' });
    // The ALLOW is an ordinary capsule: the executor accepts it like any other.
    const run = await execute({ agentId: 'TA-003', capsule: decision.capsule, signature: decision.signature, parameters: TRANSFER });
    expect(run.code).not.toBe('NOT_AUTHORIZED');
    expect(['EXECUTED', 'TOOL_FAILED']).toContain(run.code); // the transfer tool is deliberately unimplemented
  });

  it('refuses a second approval of the same request', async () => {
    const repo = await enrol();
    const d = await stepUp();
    const a = assertionFor(d.decisionHash as `0x${string}`);
    await approve(repo, d.approval!.id, DEMO_OWNER, a);
    await expect(approve(repo, d.approval!.id, DEMO_OWNER, a)).rejects.toMatchObject({ status: 409, code: 'ALREADY_RESOLVED' });
  });

  it.each([
    ['another passkey', (h: `0x${string}`) => assertionFor(h, stranger), DEMO_OWNER, 'APPROVAL_BAD_SIGNATURE'],
    ['an approval of a different decision', () => assertionFor(`0x${'77'.repeat(32)}`), DEMO_OWNER, 'APPROVAL_CHALLENGE_MISMATCH'],
    ['someone who does not own the agent', (h: `0x${string}`) => assertionFor(h), '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'NOT_THE_OWNER'],
  ])('refuses %s, and leaves the request pending', async (_name, make, who, code) => {
    const repo = await enrol();
    const d = await stepUp();
    await expect(approve(repo, d.approval!.id, who, make(d.decisionHash as `0x${string}`))).rejects.toMatchObject({ code });
    expect((await repo.getApproval(d.approval!.id))!.status).toBe('PENDING');
  });

  it('cannot approve past a suspension that happened in between', async () => {
    const repo = await enrol();
    const d = await stepUp();
    await repo.updateAgent('TA-003', { status: 'SUSPENDED' });
    try {
      await expect(approve(repo, d.approval!.id, DEMO_OWNER, assertionFor(d.decisionHash as `0x${string}`))).rejects.toMatchObject({
        status: 409,
        code: 'NO_LONGER_ALLOWED',
      });
    } finally {
      await repo.updateAgent('TA-003', { status: 'ACTIVE' });
    }
  });

  it('expires', async () => {
    const repo = await enrol();
    const d = await stepUp();
    await repo.updateApproval(d.approval!.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(approve(repo, d.approval!.id, DEMO_OWNER, assertionFor(d.decisionHash as `0x${string}`))).rejects.toMatchObject({ status: 410 });
    expect((await repo.getApproval(d.approval!.id))!.status).toBe('EXPIRED');
  });

  it('does not let the shared demo account enrol an approver', async () => {
    const repo = await getRepository();
    await expect(
      registerApprover(repo, DEMO_OWNER, { credentialId: CRED, publicKeySpki: 'AAAA' }),
    ).rejects.toBeInstanceOf(ApprovalError);
  });

  it('lets the operator enrol for the demo account with the configured code, and nobody else', async () => {
    const repo = await getRepository();
    const spki = toBase64Url(new Uint8Array(passkey.publicKey.export({ format: 'der', type: 'spki' })));
    vi.stubEnv('DEMO_APPROVER_ENROLMENT_CODE', 'a-long-enough-operator-code');
    await expect(registerApprover(repo, DEMO_OWNER, { credentialId: CRED, publicKeySpki: spki, enrolmentCode: 'guess' })).rejects.toMatchObject({ status: 403 });
    await expect(registerApprover(repo, DEMO_OWNER, { credentialId: CRED, publicKeySpki: spki })).rejects.toMatchObject({ status: 403 });
    const key = await registerApprover(repo, DEMO_OWNER, { credentialId: CRED, publicKeySpki: spki, enrolmentCode: 'a-long-enough-operator-code' });
    expect(key.publicKeyX).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('only enrols a P-256 key', async () => {
    const repo = await getRepository();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(
      registerApprover(repo, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', {
        credentialId: CRED,
        publicKeySpki: toBase64Url(new Uint8Array(rsa.publicKey.export({ format: 'der', type: 'spki' }))),
      }),
    ).rejects.toMatchObject({ code: 'NOT_A_P256_KEY' });
  });
});
