import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInterviewContext } from "../context/InterviewContext";
import "./candidateform.css";

function CandidateForm() {
  const navigate = useNavigate();

  const { setCandidate, setInterviewStarted } = useInterviewContext();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    role: "",
    experience: "",
    interviewType: "",
    resume: null,
  });

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((previousData) => ({
      ...previousData,
      [name]: value,
    }));
  }

  function handleResumeChange(event) {
    const file = event.target.files[0];

    if (!file) return;

    setFormData((previousData) => ({
      ...previousData,
      resume: file,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    setCandidate(formData);
    setInterviewStarted(true);

    navigate("/interview");
  }

  return (
    <div className="candidate-page">

      <div className="candidate-header">
        <p className="form-tag">WELCOME TO ELEVO</p>

        <h1>Let's get to know you.</h1>

        <p>
          Tell us a little about yourself before your
          interview begins.
        </p>
      </div>

      <form className="candidate-form" onSubmit={handleSubmit}>

        <div className="form-group">
          <label htmlFor="name">Full Name</label>

          <input
            id="name"
            name="name"
            type="text"
            placeholder="Enter your name"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">Email</label>

          <input
            id="email"
            name="email"
            type="email"
            placeholder="Enter your email"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="role">Role You're Applying For</label>

          <input
            id="role"
            name="role"
            type="text"
            placeholder="e.g. Software Engineer"
            value={formData.role}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="experience">Experience Level</label>

          <select
            id="experience"
            name="experience"
            value={formData.experience}
            onChange={handleChange}
            required
          >
            <option value="">Select experience level</option>
            <option value="student">Student / Fresher</option>
            <option value="junior">0–2 years</option>
            <option value="mid">2–5 years</option>
            <option value="senior">5+ years</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="interviewType">Interview Type</label>

          <select
            id="interviewType"
            name="interviewType"
            value={formData.interviewType}
            onChange={handleChange}
            required
          >
            <option value="">Select interview type</option>
            <option value="technical">Technical</option>
            <option value="behavioral">Behavioral</option>
            <option value="mixed">Technical + Behavioral</option>
          </select>
        </div>

        {/* Resume Upload */}
        <div className="form-group">
          <label htmlFor="resume">Resume</label>

          <div className="resume-upload">
            <input
              id="resume"
              name="resume"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleResumeChange}
              required
            />

            <p className="resume-hint">
              Upload your resume (PDF, DOC or DOCX)
            </p>

            {formData.resume && (
              <p className="resume-name">
                📄 {formData.resume.name}
              </p>
            )}
          </div>
        </div>

        <button type="submit" className="start-button">
          Start Interview →
        </button>

      </form>
    </div>
  );
}

export default CandidateForm;