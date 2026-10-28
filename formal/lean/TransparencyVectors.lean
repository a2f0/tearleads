import Tearleads.Transparency.Vectors

/-- Prints the transparency vector fixture to standard output. -/
def main : IO Unit :=
  IO.print Tearleads.Transparency.Vectors.fixture
