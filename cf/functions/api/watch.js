import { watch, json } from "../_lib.js";
export const onRequestGet = () => json([...watch].sort((a, b) => b.rating - a.rating));
