import { createBrowserRouter } from "react-router-dom";

import Home from "./pages/Home";
import CandidateForm from "./pages/CandidateForm";
import Interview from "./pages/Interview";
import Feedback from "./pages/Feedback";
import NotFound from "./pages/NotFound";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/candidate",
    element: <CandidateForm />,
  },
  {
    path: "/interview",
    element: <Interview />,
  },
  {
    path: "/feedback",
    element: <Feedback />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
]);

export default router;