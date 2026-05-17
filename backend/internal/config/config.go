package config

import (
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port         string
	RedisURL     string
	JWTSecret    string
	VAPIDPublic  string
	VAPIDPrivate string
	VAPIDSubject string
}

func Load() *Config {
	_ = godotenv.Load()

	c := &Config{
		Port:         getEnv("PORT", "8080"),
		RedisURL:     getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:    getEnv("JWT_SECRET", ""),
		VAPIDPublic:  getEnv("VAPID_PUBLIC", ""),
		VAPIDPrivate: getEnv("VAPID_PRIVATE", ""),
		VAPIDSubject: getEnv("VAPID_SUBJECT", ""),
	}
	if c.JWTSecret == "" {
		log.Fatal("JWT_SECRET env var is required")
	}
	if c.VAPIDPublic == "" || c.VAPIDPrivate == "" {
		log.Printf("VAPID_PUBLIC / VAPID_PRIVATE not set — web push notifications disabled")
	} else if !strings.HasPrefix(c.VAPIDSubject, "mailto:") && !strings.HasPrefix(c.VAPIDSubject, "https:") {
		// Push services (FCM in particular) reject VAPID JWTs whose `sub` claim
		// is not a mailto: or https: URI with HTTP 403. Fail fast instead of
		// shipping every notification into a black hole.
		log.Fatalf("VAPID_SUBJECT must start with \"mailto:\" or \"https:\" (got %q)", c.VAPIDSubject)
	}
	return c
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
