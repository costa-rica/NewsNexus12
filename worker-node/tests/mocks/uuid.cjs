const crypto = require('node:crypto');

function uuidFromBytes(bytes, version) {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function v1() {
  return uuidFromBytes(crypto.randomBytes(16), 1);
}

function v4() {
  return crypto.randomUUID();
}

module.exports = {
  v1,
  v4
};
