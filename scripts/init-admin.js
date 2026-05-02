require("dotenv").config();

const bcrypt = require("bcryptjs");
const config = require("../server/config");
const { initializeDatabase, upsertAdminUser, closeDatabase } = require("../server/db");

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

async function main() {
  const cliUsername = parseArg("username");
  const cliPassword = parseArg("password");

  const username = cliUsername || process.env.ADMIN_USERNAME || "";
  const password = cliPassword || process.env.ADMIN_PASSWORD || "";

  if (!username || !password) {
    console.error("Missing admin credentials. Use env ADMIN_USERNAME/ADMIN_PASSWORD or --username= --password=");
    process.exit(1);
  }

  if (username.length > 64 || password.length > 256) {
    console.error("Invalid credential length.");
    process.exit(1);
  }

  await initializeDatabase();
  const hash = bcrypt.hashSync(password, config.bcryptRounds);
  const result = await upsertAdminUser(username, hash);
  if (result.created) {
    console.log(`Admin user created: ${username}`);
  } else {
    console.log(`Admin user updated: ${username}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await closeDatabase();
  });
