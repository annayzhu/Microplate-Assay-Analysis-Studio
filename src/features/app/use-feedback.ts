import { useState } from "react";

export function useFeedback() {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  return { notice, setNotice, error, setError };
}
