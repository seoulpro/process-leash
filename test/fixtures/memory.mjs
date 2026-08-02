const allocation = Buffer.alloc(96 * 1_024 * 1_024, 0x5a);

setInterval(() => {
  if (allocation[0] !== 0x5a) process.exit(1);
}, 1_000);
