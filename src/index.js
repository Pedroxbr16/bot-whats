const config = require('./config');
const { createClient } = require('./client');
const { createRuntimeState } = require('./state/runtimeState');
const { createGroupService } = require('./services/groupService');
const { createInternetService } = require('./services/internetService');
const { registerClientEvents } = require('./handlers/registerClientEvents');

const client = createClient(config);
const runtimeState = createRuntimeState(config);
const groupService = createGroupService(client);
const internetService = createInternetService(config);

registerClientEvents({
  client,
  config,
  runtimeState,
  groupService,
  internetService
});

client.initialize();
