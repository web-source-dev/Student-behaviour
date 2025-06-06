const config = {
  // Use just the host for flexibility; add protocol dynamically later
  API_HOST: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'localhost:8000' 
    : window.location.host,

  // WebSocket URL builder
  getWebSocketURL(endpoint) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${this.API_HOST}/${endpoint}`;
  },

  // HTTP API URL builder
  getApiURL(endpoint) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${this.API_HOST}/${endpoint}`;
  }
};

export default config;
