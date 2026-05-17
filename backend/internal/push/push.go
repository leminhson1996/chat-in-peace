// Package push sends Web Push notifications to subscribed devices.
//
// Subscriptions are stored in Redis as JSON blobs at user:{username}:push.
// On send, dead subscriptions (404/410 from the push service) are pruned.
package push

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"strings"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"

	rdb "chatinpeace/internal/redis"
)

type Sender struct {
	redis   *rdb.Client
	options *webpush.Options
	enabled bool
}

// New returns a Sender. If publicKey or privateKey is empty, the Sender is a
// no-op (web push is opt-in via env vars).
func New(redis *rdb.Client, publicKey, privateKey, subject string) *Sender {
	if publicKey == "" || privateKey == "" {
		return &Sender{redis: redis, enabled: false}
	}
	// webpush-go's vapid.go blindly prepends "mailto:" to anything that does
	// not start with "https:", producing "mailto:mailto:..." when the env var
	// already carries the (RFC 8292 spec-correct) "mailto:" prefix. Apple's
	// web.push.apple.com is the only push service strict enough to reject
	// the resulting URI — with HTTP 403 BadJwtToken. Strip the prefix here so
	// the library re-adds exactly one.
	subscriber := strings.TrimPrefix(subject, "mailto:")
	return &Sender{
		redis:   redis,
		enabled: true,
		options: &webpush.Options{
			Subscriber:      subscriber,
			VAPIDPublicKey:  publicKey,
			VAPIDPrivateKey: privateKey,
			TTL:             60,
		},
	}
}

func (s *Sender) Enabled() bool { return s != nil && s.enabled }

// Payload is the JSON body delivered to the service worker's push event.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Tag   string `json:"tag,omitempty"` // used to coalesce notifications per conversation
	URL   string `json:"url,omitempty"` // where to focus/open on click
}

// Send fan-outs the payload to every device subscribed for `username`. Dead
// subscriptions are removed from Redis. Safe to call when disabled.
func (s *Sender) Send(ctx context.Context, username string, payload Payload) {
	if !s.Enabled() {
		return
	}
	subs, err := s.redis.GetPushSubs(ctx, username)
	if err != nil {
		log.Printf("push: getsubs %s: %v", username, err)
		return
	}
	if len(subs) == 0 {
		log.Printf("push: %s has no subscriptions", username)
		return
	}
	log.Printf("push: sending to %s (%d sub(s))", username, len(subs))
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	var wg sync.WaitGroup
	for _, raw := range subs {
		var sub webpush.Subscription
		if err := json.Unmarshal([]byte(raw), &sub); err != nil {
			// Malformed entry — drop it.
			_ = s.redis.RemovePushSub(ctx, username, raw)
			continue
		}
		wg.Add(1)
		go func(raw string, sub webpush.Subscription) {
			defer wg.Done()
			resp, err := webpush.SendNotificationWithContext(ctx, body, &sub, s.options)
			if err != nil {
				log.Printf("push: send to %s failed: %v", username, err)
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 400 {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
				log.Printf("push: %s endpoint -> HTTP %d body=%q endpoint=%s", username, resp.StatusCode, string(body), sub.Endpoint)
			} else {
				log.Printf("push: %s endpoint -> HTTP %d", username, resp.StatusCode)
			}
			if resp.StatusCode == 403 || resp.StatusCode == 404 || resp.StatusCode == 410 {
				// 404/410: subscription was unsubscribed or expired.
				// 403: VAPID auth rejected — usually means the subscription was
				// created with a different VAPID public key than we're now
				// signing with (key rotation, fresh .env). Either way the sub
				// is permanently unusable for this server, so drop it.
				_ = s.redis.RemovePushSub(ctx, username, raw)
			}
		}(raw, sub)
	}
	wg.Wait()
}
