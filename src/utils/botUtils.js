const env = require('../config/env');

function commandRegex(command, withArgs = true) {
  const suffix = '(?:@\\w+)?';
  const args = withArgs ? '(?:\\s+(.+))?' : '';
  return new RegExp(`^/${command}${suffix}${args}$`, 'i');
}

function isAllowedUser(userId) {
  if (!env.allowedUserIds.length) return true;
  return env.allowedUserIds.includes(String(userId));
}

function extractAxiosError(error) {
  const data = error?.response?.data;
  if (typeof data === 'string') return data;
  return (
    data?.message ||
    data?.error ||
    data?.msg ||
    error?.message ||
    'Da xay ra loi khong xac dinh'
  );
}

module.exports = {
  commandRegex,
  isAllowedUser,
  extractAxiosError
};
