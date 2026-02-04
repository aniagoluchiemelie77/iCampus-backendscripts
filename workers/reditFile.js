import redis from "redis";

let client;

if (!client) {
  client = redis.createClient({
    url: "redis://127.0.0.1:6379",
  });

  client.on("error", (err) => console.error("Redis Error:", err));

  await client.connect();
  console.log("Redis client instance:", client);
  console.log("Client address:", client?.options?.socket);
}

export { client };

console.log("Redis connected:", client.isOpen);


