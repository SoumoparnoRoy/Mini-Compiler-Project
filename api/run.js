const { runCompiler } = require('../lib/run-compiler');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to run a program.' });
  }
  const source = req.body && typeof req.body === 'object' ? req.body.source : undefined;
  const result = await runCompiler(source);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.status).json(result.body);
};
