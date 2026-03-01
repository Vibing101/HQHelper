import mongoose from "mongoose";

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri);
  console.log("[db] Connected to MongoDB");
}
