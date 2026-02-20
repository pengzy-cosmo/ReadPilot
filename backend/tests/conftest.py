"""conftest - pytest fixtures and configuration."""

import sys
from pathlib import Path

# Add parent directory to Python path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import tempfile

import pytest


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory for test data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def sample_pdf_bytes():
    """Return minimal valid PDF bytes for testing."""
    # This is a minimal valid PDF structure
    return b"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj

xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n

trailer
<<
/Size 4
/Root 1 0 R
>>
startxref
196
%%EOF"""


@pytest.fixture
def sample_multi_page_pdf_bytes():
    """Return minimal valid multi-page PDF bytes for testing."""
    return b"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R 4 0 R 5 0 R]
/Count 3
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj

4 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj

5 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj

xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000122 00000 n
0000000189 00000 n
0000000256 00000 n

trailer
<<
/Size 6
/Root 1 0 R
>>
startxref
323
%%EOF"""
