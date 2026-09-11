"""Test bdjobs scraper integration.

To test bdjobs scraping functionality, you'll need to:

1. First explore bdjobs website structure to identify:
   - Job listing container selectors
   - Job title selectors
   - Company name selectors
   - Location selectors
   - Job URLs
   - Job detail page structure

2. Write test HTML files that match bdjobs page structure

3. Test the parser with sample HTML

Example test approach:
"""

import pytest
from pathlib import Path
from auto_job_host.parser.bdjobs import BdjobsParser

# Test data - based on actual bdjobs HTML structure
SAMPLE_SEARCH_HTML = '''
<!DOCTYPE html>
<html>
<head><title>Bdjobs Search Results</title></head>
<body>
<main class="mobile-job-list">
    <app-job-card>
        <a href="/h/details/1531978?ln=1">
            <div class="relative h-full">
                <div class="flex-1 min-w-full flex justify-between text-\[13px\] text-\[333\]">
                    <div class="w-full flex flex-col gap-2">
                        <div class="flex gap-1.5 justify-between">
                            <div class="self-start flex flex-col max-w-\[80\%\] gap-2">
                                <p data-testid="job-title" apphighlight="" class="font-bold block break-words whitespace-wrap text-base text-\[B32D7D\] md:text-\[338033\]">
                                    Customer Relation Manager
                                </p>
                                <p apphighlight="" class="font-bold text-\[333\]">SEOK Healthcare</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1">
                            <span class="icon-location"></span>
                            <p class="break-words whitespace-normal text-\[333\]"> Dhaka, Khulna </p>
                        </div>
                    </div>
                </div>
            </div>
        </a>
    </app-job-card>
    <app-job-card>
        <a href="/h/details/1531982?ln=1">
            <div class="relative h-full">
                <div class="flex-1 min-w-full flex justify-between text-\[13px\] text-\[333\]">
                    <div class="w-full flex flex-col gap-2">
                        <div class="flex gap-1.5 justify-between">
                            <div class="self-start flex flex-col max-w-\[80\%\] gap-2">
                                <p data-testid="job-title" apphighlight="" class="font-bold block break-words whitespace-wrap text-base text-\[B32D7D\] md:text-\[338033\]">
                                    Assistant Project Officer (WASH) - Humanitarian &amp; Resilience Programme
                                </p>
                                <p apphighlight="" class="font-bold text-\[333\]">Islamic Relief Bangladesh</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1">
                            <span class="icon-location"></span>
                            <p class="break-words whitespace-normal text-\[333\]"> Mymensingh, Sherpur </p>
                        </div>
                    </div>
                </div>
            </div>
        </a>
    </app-job-card>
</main>
</body>
</html>
'''

SAMPLE_DETAIL_HTML = '''
<!DOCTYPE html>
<html>
<head><title>Customer Relation Manager - SEOK Healthcare</title></head>
<body>
<div class="job-detail-container">
    <h1 class="job-title">Customer Relation Manager</h1>
    <div class="company-name">SEOK Healthcare</div>
    <div class="job-location"> Dhaka, Khulna </div>
    <div class="job-description">
        <p>We are looking for a customer relation manager with excellent communication skills...</p>
        <ul>
            <li>3+ years of experience in customer service</li>
            <li>Excellent communication and interpersonal skills</li>
            <li>Team player with positive attitude</li>
        </ul>
        <p><strong>Job Details:</strong></p>
        <ul>
            <li>Company: SEOK Healthcare</li>
            <li>Location: Dhaka, Khulna</li>
            <li>Job Type: Full-time</li>
            <li>Deadline: 20 Sep 2026</li>
        </ul>
    </div>
</div>
</body>
</html>
'''


def test_bdjobs_parser_search():
    """Test parsing bdjobs search results."""
    parser = BdjobsParser()
    jobs = parser.parse_search(SAMPLE_SEARCH_HTML, "https://www.bdjobs.com")
    
    assert len(jobs) == 2
    assert jobs[0].title == "Customer Relation Manager"
    assert jobs[0].company == "SEOK Healthcare"
    assert jobs[0].location == " Dhaka, Khulna "
    assert jobs[0].external_job_id == "1531978"
    assert jobs[0].url == "https://bdjobs.com/h/details/1531978?ln=1"
    
    assert jobs[1].title == "Assistant Project Officer (WASH) - Humanitarian & Resilience Programme"
    assert jobs[1].company == "Islamic Relief Bangladesh"
    assert jobs[1].location == " Mymensingh, Sherpur "
    assert jobs[1].external_job_id == "1531982"
    assert jobs[1].url == "https://bdjobs.com/h/details/1531982?ln=1"


def test_bdjobs_parser_detail():
    """Test parsing bdjobs job detail page."""
    parser = BdjobsParser()
    job = parser.parse_detail(SAMPLE_DETAIL_HTML, "https://bdjobs.com/h/details/1531978")
    
    assert job is not None
    assert job.title == "Customer Relation Manager"
    assert job.company == "SEOK Healthcare"
    assert job.location == " Dhaka, Khulna "
    assert "We are looking for a customer relation manager" in job.description


def test_bdjobs_parser_ref_numbers():
    """Test extracting reference numbers from HTML."""
    parser = BdjobsParser()
    html = '''
    <a href="/h/details/1531978?ln=1">Job 1</a>
    <a href="/h/details/1531982?ln=1">Job 2</a>
    <span ref-no="123456">Ref 1</span>
    <script id="ng-state" type="application/json">
    {"jobs": [{"JP_ID": "789012"}]}
    </script>
    '''
    
    refs = parser.extract_ref_numbers(html)
    assert "1531978" in refs
    assert "1531982" in refs
    assert len(refs) >= 2


def test_bdjobs_parser_no_main_container():
    """Test handling of HTML without main.mobile-job-list container."""
    parser = BdjobsParser()
    html = '''
    <html><body>
        <div>Some other content without job list</div>
    </body></html>
    '''
    
    jobs = parser.parse_search(html, "https://www.bdjobs.com")
    assert len(jobs) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
