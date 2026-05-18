const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || 'change-this-secret';
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role
    },
    getSecret(),
    { expiresIn: '12h' }
  );
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  return next();
}

module.exports = {
  signToken,
  authenticate,
  requireAdmin
};
