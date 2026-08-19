/** `GET /healthz` — liveness probe for the StatusDog site itself. */
export default function handler(_req, res) {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    status: 'ok',
    service: 'statusdog-web',
    time: new Date().toISOString(),
  });
}
