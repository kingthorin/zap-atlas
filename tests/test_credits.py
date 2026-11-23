from atlas.credits import build_core_team, parse_team

PAGE = """<H1>Credits</H1><H2>ZAP Core Team (Current)</H2>People.<br>
<table>
<tr><td>&nbsp;</td><td><a href="https://www.zaproxy.org/docs/team/psiinon/">Simon Bennetts</a> - Sponsored by Checkmarx</td></tr>
<tr><td>&nbsp;</td><td>Rick Mitchell (Kingthorin) - Mozilla</td></tr>
<tr><td>&nbsp;</td><td>someone@example.org</td></tr>
<tr><td>&nbsp;</td><td>Ken Treimann, Cyber Ninja</td></tr>
</table><H2>ZAP Extended Team</H2><table><tr><td>&nbsp;</td><td>Not Core</td></tr></table>"""


def test_parse_takes_the_first_section_cuts_suffixes_and_skips_email_rows():
    assert parse_team(PAGE) == [("Simon Bennetts", "", "psiinon"), ("Rick Mitchell", "Kingthorin", ""), ("Ken Treimann", "", "")]
    assert parse_team("<h1>no sections</h1>") == []


def test_aliases_handles_and_longer_names_make_one_person_with_intervals():
    snaps = [("2011-01-01", [("Psiinon", "", "")]),
             ("2012-01-01", [("Simon Bennetts", "Psiinon", ""), ("Cosmin Stefan", "", "")]),
             ("2013-01-01", [("Simon Bennetts", "", "psiinon"), ("Cosmin Stefan-Dobrin", "", "")]),
             ("2014-01-01", [("Simon Bennetts", "", ""), ("Newcomer", "", "")])]
    people = {p["name"]: p["intervals"] for p in build_core_team(snaps)}
    assert people["Simon Bennetts"] == [["2011-01-01", None]]                     # "Psiinon" is the same person
    assert people["Cosmin Stefan-Dobrin"] == [["2012-01-01", "2014-01-01"]]         # a longer form of the same name
    assert people["Newcomer"] == [["2014-01-01", None]] and "Cosmin Stefan" not in people


def test_short_absences_are_bridged_and_long_ones_split():
    snaps = [("2020-01-01", [("A B", "", "")]), ("2020-02-01", []), ("2020-03-01", [("A B", "", "")]),
             ("2021-01-01", []), ("2022-06-01", [("A B", "", "")])]
    snaps = [(d, r) for d, r in snaps]
    # the second snapshot has nobody: the 31-day gap is bridged; the 2021 to 2022 gap is not
    assert build_core_team(snaps)[0]["intervals"] == [["2020-01-01", "2021-01-01"], ["2022-06-01", None]]


def test_core_team_privacy_check(tmp_path):
    import json
    from atlas.integrity import check_core_team
    (tmp_path / "core_team.json").write_text(json.dumps({"people": [{"name": "a@b.org", "intervals": [["2020-01-01", None]]},
                                                                      {"name": "Ok", "intervals": [["2020-02-01", "2020-01-01"]]}]}))
    errors = check_core_team(tmp_path)
    assert any("email" in e for e in errors) and any("ends before" in e for e in errors)
