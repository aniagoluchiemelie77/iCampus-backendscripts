import redis from "redis";

export const client = redis.createClient();

client.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

await client.connect();
