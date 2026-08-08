import "./navbar.css";

function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-logo">ELEVO</div>

      <div className="navbar-links">
        <a href="/">Home</a>
        <a href="/candidate">Start Interview</a>
      </div>
    </nav>
  );
}

export default Navbar;