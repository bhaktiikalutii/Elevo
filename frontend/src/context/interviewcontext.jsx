import { createContext, useContext, useState } from "react";

const InterviewContext = createContext();

export function InterviewProvider({ children }) {
  const [candidate, setCandidate] = useState({
    name: "",
    email: "",
    role: "",
    experience: "",
    interviewType: "",
  });

  const [interviewStarted, setInterviewStarted] = useState(false);

  return (
    <InterviewContext.Provider
      value={{
        candidate,
        setCandidate,
        interviewStarted,
        setInterviewStarted,
      }}
    >
      {children}
    </InterviewContext.Provider>
  );
}

export function useInterviewContext() {
  return useContext(InterviewContext);
}