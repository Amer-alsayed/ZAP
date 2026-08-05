import { io } from "socket.io-client";
const socket = io("http://localhost:3000");

socket.on("connect", () => {
    socket.emit("register", { username: "testuser5", publicKey: "dummy", salt: "dummy" }, (response) => {
        console.log(response);
        process.exit(0);
    });
});
