const CLIENT_ID = 'Ov23li0tS7999YEt5rkY'
const SCOPE = 'repo'
const VERIFY_URL = 'https://github.com/login/device'

export async function startDeviceFlow() {
  const data = await window.electronAPI.requestDeviceCode(CLIENT_ID, SCOPE)

  if (data.error) {
    throw new Error(data.error_description || data.error)
  }
  if (!data.device_code || !data.user_code) {
    throw new Error('Device Flow not enabled. Check OAuth App settings on GitHub.')
  }

  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri || VERIFY_URL,
    deviceCode: data.device_code,
    interval: data.interval || 5,
  }
}

export async function pollForToken(deviceCode, interval) {
  const result = await window.electronAPI.pollForToken(CLIENT_ID, deviceCode, interval)
  if (result.ok) return result.token
  throw new Error(result.error)
}

export async function openInBrowser(url) {
  await window.electronAPI.openExternal(url || VERIFY_URL)
}
