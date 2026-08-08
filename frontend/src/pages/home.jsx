import Navbar from "../components/navbar/navbar";
import "./Home.css";

function Home() {
  return (
    <div className="home-page">
      <Navbar />

      <main className="hero">
        <p className="hero-tag">AI-POWERED INTERVIEW AGENT</p>

        <h1>
          Your interview.
          <br />
          <span>Reimagined.</span>
        </h1>

        <p className="hero-description">
          Have a real conversation with an AI interviewer that adapts
          to you, challenges your thinking, and helps you improve.
        </p>

        <a href="/candidate" className="hero-button">
          Start Interview →
        </a>
      </main>
    </div>
  );
}

export default Home;