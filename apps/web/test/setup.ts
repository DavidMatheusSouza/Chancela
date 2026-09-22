/**
 * Keep the suite off the live deployment.
 *
 * `getRepository()` picks Postgres whenever `DATABASE_URL` is set, and
 * `anchorDecision()` spends real gas whenever the attestation key and registry
 * are. A developer who has exported the deployment's `.env` -- to run
 * `verify:deployment`, or just out of habit -- would otherwise have `pnpm test`
 * write to the database the demo runs on: the breaker tests suspend an agent,
 * and the flow tests then fail with AGENT_SUSPENDED against a *live* agent that
 * a judge is about to open.
 *
 * The tests that want a database bring their own. The rest run in memory,
 * which is also what CI does, so local and CI cannot disagree.
 */
delete process.env.DATABASE_URL;
delete process.env.ATTESTATION_PRIVATE_KEY;
delete process.env.POLICY_REGISTRY_ADDRESS;
delete process.env.APPROVALS_ADDRESS;
delete process.env.MONAD_RPC_URL;
delete process.env.MONAD_TESTNET_RPC_URL;
