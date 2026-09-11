"""Tests for JWT secret handling (Round 2 Task 2 follow-up).

src/api/auth.py issues its own 12-hour session token (create_session_token)
signed with JWT_SECRET, stored in the rippleeta_session cookie, and verified
on every subsequent request (verify_session_token / get_current_user).
verify_google_token is only used once, at initial login, to check the
credential Google's client-side widget hands back — it is not what
authorizes later requests. So JWT_SECRET signs a real, longer-lived
session, and how it is sourced matters: these tests prove the fix (read
from JWT_SECRET env var; generate a random one only when unset) behaves
correctly in both directions.
"""

import importlib

import jwt as pyjwt
import pytest

import src.api.auth as auth_module


@pytest.fixture(autouse=True)
def _restore_auth_module():
    """Every test here reloads src.api.auth, mutating its module-level
    JWT_SECRET in place (other already-imported references share the same
    module dict). Always leave it holding a fresh random secret afterward
    so later tests in the suite aren't affected by whatever this test left
    behind.
    """
    yield
    import os

    os.environ.pop("JWT_SECRET", None)
    importlib.reload(auth_module)


def test_session_token_is_ripple_etas_own_jwt_not_the_google_credential():
    """Confirms the premise: per-request auth checks RippleETA's own signed
    token, not Google's ID token directly."""
    token = auth_module.create_session_token("judge@example.com", "passenger")
    decoded = pyjwt.decode(
        token, auth_module.JWT_SECRET, algorithms=[auth_module.JWT_ALGORITHM]
    )
    assert decoded["sub"] == "judge@example.com"
    assert decoded["role"] == "passenger"
    # A real session lifetime, not a short-lived token — this is exactly
    # the kind of token an unstable signing secret would silently break.
    assert (decoded["exp"] - decoded["iat"]) == 12 * 60 * 60


def test_jwt_secret_stays_stable_across_reimports_when_env_var_is_set(monkeypatch):
    """Simulates a process restart with a real deployment's JWT_SECRET set:
    the secret — and therefore existing sessions — must survive it."""
    monkeypatch.setenv("JWT_SECRET", "a-fixed-deployment-secret-abc123")
    importlib.reload(auth_module)
    assert auth_module.JWT_SECRET == "a-fixed-deployment-secret-abc123"

    token = auth_module.create_session_token("judge@example.com", "passenger")

    # Simulate a restart: reload again with the same env var still set.
    importlib.reload(auth_module)
    assert auth_module.JWT_SECRET == "a-fixed-deployment-secret-abc123"

    # A token issued by the "pre-restart" process must still verify against
    # the "post-restart" process — this is the real fix, not just "doesn't
    # crash."
    decoded = auth_module.verify_session_token(token)
    assert decoded["sub"] == "judge@example.com"


def test_jwt_secret_falls_back_to_random_only_when_unset(monkeypatch):
    """Confirms the fallback is opt-in (unset only), not unconditional."""
    monkeypatch.delenv("JWT_SECRET", raising=False)
    importlib.reload(auth_module)
    secret_when_unset = auth_module.JWT_SECRET

    monkeypatch.setenv("JWT_SECRET", "a-fixed-deployment-secret-xyz789")
    importlib.reload(auth_module)
    assert auth_module.JWT_SECRET == "a-fixed-deployment-secret-xyz789"
    assert auth_module.JWT_SECRET != secret_when_unset


def test_documented_tradeoff_unconfigured_restart_invalidates_prior_sessions(
    monkeypatch,
):
    """This is the honest, acceptable-by-design failure mode: an
    unconfigured deployment (JWT_SECRET never set) generates a fresh random
    secret every process start, so a token from before a restart no longer
    verifies after one. Pinned here so it can't silently regress into
    something worse (like falling back to a fixed, predictable value)."""
    monkeypatch.delenv("JWT_SECRET", raising=False)
    importlib.reload(auth_module)
    token = auth_module.create_session_token("demo@example.com", "passenger")

    # Simulate a restart with JWT_SECRET still unset.
    importlib.reload(auth_module)

    with pytest.raises(pyjwt.InvalidTokenError):
        pyjwt.decode(
            token, auth_module.JWT_SECRET, algorithms=[auth_module.JWT_ALGORITHM]
        )
