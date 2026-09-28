import { buildSubject } from "../../core/subject";

export const johnSubject = () =>
  buildSubject(
    "p1",
    [
      { type: "FULL_NAME", value: "John Example", isPrevious: false },
      { type: "EMAIL", value: "john@example.com", isPrevious: false },
      { type: "PHONE", value: "(555) 555-1234", isPrevious: false },
      { type: "USERNAME", value: "jexample", isPrevious: false },
      { type: "LOCATION", value: "Boca Raton, FL", isPrevious: false },
      { type: "DATE_OF_BIRTH", value: "1985-03-01", isPrevious: false },
      { type: "DOMAIN", value: "johnexample.dev", isPrevious: false },
    ],
    { email: "john@example.com", isRelay: false },
  );
