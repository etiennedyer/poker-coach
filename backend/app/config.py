from pydantic import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Poker Coaching MVP"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    ws_token_minutes: int = 30
    session_secret: str = "change-session"
    session_cookie_name: str = "poker_session"
    allowed_origin: str = "http://localhost:8000"
    db_url: str = ""
    environment: str = "dev"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-2024-08-06"
    openai_max_input_tokens: int = 400
    openai_max_output_tokens: int = 200
    openai_daily_token_cap: int = 2000

    class Config:
        env_file = ".env"
        env_prefix = "POKER_"


settings = Settings()
