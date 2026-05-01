const { randomUUID } = require('crypto');

const NIL = '00000000-0000-0000-0000-000000000000';
const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const v4 = () => randomUUID();
const v1 = () => randomUUID();
const validate = value => typeof value === 'string' && UUID_PATTERN.test(value);
const version = value => {
  if (!validate(value)) {
    throw new TypeError('invalid uuid');
  }

  return Number(value[14]);
};

module.exports = {
  MAX,
  NIL,
  v1,
  v4,
  validate,
  version
};
