(() => {
  'use strict';

  const OMNIFLOW_CONFIG = {
    BRAND_NAME: 'OmniFlow',
    VERSION: '1.0.0',
    CONTENT_SCRIPT_ID: 'omniflow-core',
    DIAGNOSTIC_ATTRIBUTE: 'data-omniflow-state',
    SPEC_MESSAGE_TYPE: 'omniflow:config',
    SPEC_REQUEST_TYPE: 'omniflow:config-request',
    FLOW_URL: 'https://flow.google.com/',
    VALIDATION_ENDPOINT: 'https://omniflow-admin.vercel.app/api/validate',
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.OMNIFLOW_CONFIG = OMNIFLOW_CONFIG;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OMNIFLOW_CONFIG;
  }
})();
